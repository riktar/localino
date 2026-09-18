#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <errno.h>

static NSString *settingsHash(NSData *data) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes,(CC_LONG)data.length,digest);
  NSMutableString *value=[NSMutableString string];
  for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[value appendFormat:@"%02x",digest[i]];
  return value;
}
static BOOL settingsRead(NSString *path,NSData **data,struct stat *identity,BOOL *exists) {
  if(lstat(path.fileSystemRepresentation,identity)!=0) {
    if(errno!=ENOENT)return NO;
    *exists=NO;*data=[NSData data];return YES;
  }
  if(!S_ISREG(identity->st_mode)||identity->st_nlink!=1||identity->st_uid!=getuid()||identity->st_size>8*1024*1024)return NO;
  int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  if(fd<0)return NO;
  struct stat opened;BOOL same=fstat(fd,&opened)==0&&opened.st_dev==identity->st_dev&&opened.st_ino==identity->st_ino;
  if(!same){close(fd);return NO;}
  NSMutableData *bytes=[NSMutableData data];char buffer[8192];ssize_t count;
  while((count=read(fd,buffer,sizeof(buffer)))>0){[bytes appendBytes:buffer length:(NSUInteger)count];if(bytes.length>8*1024*1024){close(fd);return NO;}}
  close(fd);if(count<0)return NO;*data=bytes;*exists=YES;return YES;
}
/* Serialize Localino writers and participate in native file coordination.
 * The final identity/hash check detects observed outside edits. macOS advisory
 * coordination does NOT fence writers that ignore it; this is not NTFS CAS.
 */
static int updateSettings(void) {
  NSData *input=[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
  if(input.length>8*1024*1024)return 4;
  id request=[NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
  if(![request isKindOfClass:NSDictionary.class])return 4;
  NSString *path=request[@"path"],*expected=request[@"expectedHash"];
  id remove=request[@"remove"];
  if(![path isKindOfClass:NSString.class]||!path.isAbsolutePath||![expected isKindOfClass:NSString.class]||expected.length!=64||![remove isKindOfClass:NSNumber.class])return 4;
  // File coordination canonicalizes ancestor aliases such as /var -> /private/var.
  // Resolve only the parent so settingsRead still rejects a symlink at the leaf.
  path=[[[path stringByDeletingLastPathComponent] stringByResolvingSymlinksInPath] stringByAppendingPathComponent:path.lastPathComponent];
  NSString *lockPath=[path stringByAppendingString:@".localino.lock"];
  int gate=open(lockPath.fileSystemRepresentation,O_CREAT|O_RDWR|O_NOFOLLOW|O_CLOEXEC,0600);
  if(gate<0)return 3;
  BOOL locked=NO;
  for(int i=0;i<100;i++){if(flock(gate,LOCK_EX|LOCK_NB)==0){locked=YES;break;}usleep(10000);}
  if(!locked){close(gate);return 3;}
  __block int result=3;
  @try {
    NSFileCoordinator *coordinator=[[NSFileCoordinator alloc] initWithFilePresenter:nil];
    NSError *error=nil;
    [coordinator coordinateWritingItemAtURL:[NSURL fileURLWithPath:path] options:NSFileCoordinatorWritingForReplacing error:&error byAccessor:^(NSURL *url) {
      // Reject relocated paths rather than editing a different settings file.
      if(![url.path isEqual:path])return;
      NSData *before=nil;struct stat original={0};BOOL existed=NO;
      if(!settingsRead(path,&before,&original,&existed))return;
      if(![settingsHash(before) isEqual:expected]){result=2;return;}
      id parsed=before.length?[NSJSONSerialization JSONObjectWithData:before options:NSJSONReadingMutableContainers error:nil]:[NSMutableDictionary dictionary];
      if(![parsed isKindOfClass:NSMutableDictionary.class]){result=4;return;}
      NSMutableDictionary *settings=parsed;
      if([remove boolValue])[settings removeObjectForKey:@"statusLine"];
      else {id line=request[@"statusLine"];if(![line isKindOfClass:NSDictionary.class]){result=4;return;}settings[@"statusLine"]=line;}
      NSMutableData *replacement=[[NSJSONSerialization dataWithJSONObject:settings options:NSJSONWritingPrettyPrinted error:nil] mutableCopy];
      if(!replacement)return;[replacement appendBytes:"\n" length:1];
      NSString *temporary=[path stringByAppendingFormat:@".%@.tmp",NSUUID.UUID.UUIDString];
      int fd=open(temporary.fileSystemRepresentation,O_CREAT|O_EXCL|O_WRONLY|O_CLOEXEC,0600);
      if(fd<0)return;
      BOOL complete=YES;NSUInteger offset=0;
      while(offset<replacement.length){ssize_t n=write(fd,(const char *)replacement.bytes+offset,replacement.length-offset);if(n<0&&errno==EINTR)continue;if(n<=0){complete=NO;break;}offset+=(NSUInteger)n;}
      if(fchmod(fd,existed?(original.st_mode&0777):0600)!=0||fsync(fd)!=0)complete=NO;
      close(fd);
      if(complete){
        NSData *latest=nil;struct stat current={0};BOOL nowExists=NO;
        if(!settingsRead(path,&latest,&current,&nowExists))complete=NO;
        else if(nowExists!=existed||(existed&&(current.st_dev!=original.st_dev||current.st_ino!=original.st_ino))||![latest isEqual:before]){result=2;complete=NO;}
      }
      if(complete){
        int renamed=existed?rename(temporary.fileSystemRepresentation,path.fileSystemRepresentation):renamex_np(temporary.fileSystemRepresentation,path.fileSystemRepresentation,RENAME_EXCL);
        if(renamed==0)result=0;else if(errno==EEXIST)result=2;
      }
      unlink(temporary.fileSystemRepresentation);
    }];
    if(error)result=3;
  } @catch(NSException *exception){result=3;}
  @finally {flock(gate,LOCK_UN);close(gate);}
  return result;
}

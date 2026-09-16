#import <Foundation/Foundation.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <math.h>
#include <float.h>

static NSDictionary *document(NSString *path) {
  NSData *data=[NSData dataWithContentsOfFile:path];
  id value=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
  return [value isKindOfClass:NSDictionary.class]?value:nil;
}
static id number(id value,double max) {
  if(!value || value==NSNull.null)return NSNull.null;
  if(![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID() || !isfinite([value doubleValue]) || [value doubleValue]<0 || [value doubleValue]>max)@throw [NSException exceptionWithName:@"Invalid" reason:nil userInfo:nil];
  return value;
}
static NSDictionary *project(NSData *input,long long receivedAt) {
  if(input.length>8*1024*1024)return nil;
  id value=[NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
  if(![value isKindOfClass:NSDictionary.class])return nil;
  NSDictionary *data=value;id session=data[@"session_id"],rates=data[@"rate_limits"],cost=data[@"cost"];
  if(![session isKindOfClass:NSString.class] || ![session length] || [session length]>256)return nil;
  if(rates && rates!=NSNull.null && ![rates isKindOfClass:NSDictionary.class])return nil;
  if(cost && cost!=NSNull.null && ![cost isKindOfClass:NSDictionary.class])return nil;
  if(rates==NSNull.null)rates=nil;if(cost==NSNull.null)cost=nil;
  NSMutableArray *windows=[NSMutableArray array];
  for(NSString *key in @[@"five_hour",@"seven_day",@"spend_limit"]){
    id raw=rates[key];if(!raw || raw==NSNull.null)continue;if(![raw isKindOfClass:NSDictionary.class])return nil;
    id used=number(raw[@"used_percentage"],[key isEqual:@"spend_limit"]?DBL_MAX:100),reset=number(raw[@"resets_at"],8640000000000.0);
    [windows addObject:@{@"id":key,@"usedPercent":used,@"resetsAt":reset==NSNull.null?NSNull.null:@([reset doubleValue]*1000)}];
  }
  return @{@"sessionId":session,@"receivedAt":@(receivedAt),@"windows":windows,@"cost":number(cost[@"total_cost_usd"],DBL_MAX)};
}
static int lock(NSString *path) {
  int fd=open(path.fileSystemRepresentation,O_CREAT|O_RDWR,0600);if(fd<0)return -1;
  for(int attempt=0;attempt<12;attempt++){if(flock(fd,LOCK_EX|LOCK_NB)==0)return fd;usleep(10000);}close(fd);return -1;
}
static void cache(NSString *path,NSDictionary *config,NSData *input,long long now) {
  NSDictionary *snapshot=project(input,now);if(!snapshot)return;
  int fd=lock([path stringByAppendingString:@".lock"]);if(fd<0)return;
  @try {
    NSDictionary *current=document(path);
    if(![current[@"enabled"] isEqual:@YES] || ![current[@"generation"] isEqual:config[@"generation"]])return;
    NSString *target=current[@"cachePath"];if(![target isKindOfClass:NSString.class])return;
    NSDictionary *old=document(target);if([old[@"receivedAt"] longLongValue]>now)return;
    NSMutableDictionary *saved=[snapshot mutableCopy];saved[@"generation"]=current[@"generation"];
    NSData *data=[NSJSONSerialization dataWithJSONObject:saved options:0 error:nil];
    [data writeToFile:target options:NSDataWritingAtomic error:nil];
  } @finally { flock(fd,LOCK_UN);close(fd); }
}
static int previous(NSDictionary *config,NSData *input) {
  id previous=config[@"previous"];if(![previous isKindOfClass:NSDictionary.class])return 0;
  NSString *command=previous[@"command"];if(![command isKindOfClass:NSString.class]||!command.length)return 0;
  NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:@"/bin/bash"];task.arguments=@[@"-c",command];
  NSPipe *pipe=[NSPipe pipe];task.standardInput=pipe;task.standardOutput=NSFileHandle.fileHandleWithStandardOutput;task.standardError=NSFileHandle.fileHandleWithStandardError;
  if(![task launchAndReturnError:nil])return 1;
  @try{[pipe.fileHandleForWriting writeData:input];}@catch(NSException *exception){}@finally{[pipe.fileHandleForWriting closeFile];}
  [task waitUntilExit];return task.terminationStatus;
}
int main(int argc,const char **argv) { @autoreleasepool {
  /* There is no NTFS transaction equivalent here. Never silently substitute a racy settings overwrite. */
  if(argc==2 && strcmp(argv[1],"--settings-cas")==0)return 3;
  if(argc!=2)return 1;
  NSString *path=[NSString stringWithUTF8String:argv[1]];NSDictionary *config=document(path);if(!config)return 1;
  NSData *input=[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];
  long long now=(long long)(NSDate.date.timeIntervalSince1970*1000);
  @try{if([config[@"enabled"] isEqual:@YES])cache(path,config,input,now);}@catch(NSException *exception){}
  return previous(config,input);
} }

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <dispatch/dispatch.h>
#include <signal.h>
#include <unistd.h>
#include "ShiftGesture.h"

static void emit(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  if (!data) return;
  @synchronized ([NSFileHandle fileHandleWithStandardOutput]) {
    @try { [[NSFileHandle fileHandleWithStandardOutput] writeData:data]; [[NSFileHandle fileHandleWithStandardOutput] writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]]; }
    @catch (NSException *exception) { exit(0); }
  }
}
static id attribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  return AXUIElementCopyAttributeValue(element,name,&value) == kAXErrorSuccess ? CFBridgingRelease(value) : nil;
}
static BOOL trusted(void) { return AXIsProcessTrusted() && CGPreflightListenEventAccess(); }
static long long launchIdentity(NSRunningApplication *app) { return (long long)(app.launchDate.timeIntervalSince1970 * 1000); }
static void selection(pid_t pid) {
  alarm(2); // Hard bound even if an accessibility provider ignores its messaging timeout.
  NSString *reason = @"empty", *text = @"";
  if (!AXIsProcessTrusted()) reason = @"permissions";
  else if (IsSecureEventInputEnabled()) reason = @"protected";
  else if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) reason = @"changed";
  else {
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(app,0.15);
    id focused = attribute(app,kAXFocusedUIElementAttribute);
    if (focused && CFGetTypeID((__bridge CFTypeRef)focused) == AXUIElementGetTypeID()) {
      AXUIElementRef element = (__bridge AXUIElementRef)focused;
      AXUIElementSetMessagingTimeout(element,0.15);
      BOOL protected = NO;
      id ancestor = focused;
      for (int depth=0; depth<8 && ancestor; depth++) {
        AXUIElementRef current = (__bridge AXUIElementRef)ancestor;
        AXUIElementSetMessagingTimeout(current,0.08);
        id subrole = attribute(current,kAXSubroleAttribute);
        id secret = attribute(current,CFSTR("AXProtectedContent"));
        if ([subrole isEqual:(__bridge NSString *)kAXSecureTextFieldSubrole] || ([secret isKindOfClass:NSNumber.class] && [secret boolValue])) { protected=YES; break; }
        id parent = attribute(current,kAXParentAttribute);
        ancestor = parent && CFGetTypeID((__bridge CFTypeRef)parent) == AXUIElementGetTypeID() ? parent : nil;
      }
      if (protected) reason=@"protected";
      else {
        id selected = attribute(element,kAXSelectedTextAttribute);
        if ([selected isKindOfClass:NSString.class]) {
          if ([selected length] > 100000) reason=@"limit";
          else if ([selected length]) { text=selected; reason=@"ok"; }
        }
      }
    }
    CFRelease(app);
    if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != pid) { reason=@"changed"; text=@""; }
  }
  emit(@{@"text":text,@"reason":reason});
}

static CFMachPortRef tap;
static ShiftGesture gesture;
static BOOL enabled=YES,active=NO;
static NSInteger sequence=0;
static pid_t origin=0,parentProcess=0;
static long long originIdentity=0;
static CFAbsoluteTime started;
static NSTask *worker;
static NSString *executable;
static void terminateWorker(void) { if (worker.running) { kill(worker.processIdentifier,SIGKILL); } worker=nil; }
static void status(void) {
  NSString *reason = !AXIsProcessTrusted() ? @"permissions" : !CGPreflightListenEventAccess() ? @"input-monitoring" : @"";
  emit(@{@"type":@"status",@"enabled":@(enabled),@"error":enabled?reason:@"",@"reason":enabled?reason:@""});
}
static void restoreOrigin(void) {
  NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:origin];
  if (app && launchIdentity(app)==originIdentity) [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
}
static void capture(void) {
  if (active) { emit(@{@"type":@"raise"}); return; }
  active=YES; sequence++; NSInteger current=sequence; started=CFAbsoluteTimeGetCurrent();
  NSRunningApplication *front=NSWorkspace.sharedWorkspace.frontmostApplication;
  origin=front.processIdentifier; originIdentity=launchIdentity(front);
  emit(@{@"type":@"begin",@"id":@(current),@"origin":[NSString stringWithFormat:@"%lld",originIdentity],@"pid":@(origin)});
  if (!trusted() || origin==parentProcess || origin<=0) {
    emit(@{@"type":@"result",@"id":@(current),@"text":@"",@"reason":!trusted()?@"permissions":@"empty",@"ms":@0}); return;
  }
  NSTask *task=[NSTask new]; worker=task;
  task.executableURL=[NSURL fileURLWithPath:executable]; task.arguments=@[@"--read",[NSString stringWithFormat:@"%d",origin]];
  NSPipe *pipe=[NSPipe pipe]; task.standardOutput=pipe; task.standardError=[NSFileHandle fileHandleWithNullDevice]; task.standardInput=[NSFileHandle fileHandleWithNullDevice];
  NSError *error=nil;
  if (![task launchAndReturnError:&error]) { worker=nil; emit(@{@"type":@"result",@"id":@(current),@"text":@"",@"reason":@"unavailable",@"ms":@0}); return; }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
    NSData *data=[pipe.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    dispatch_async(dispatch_get_main_queue(),^{
      if (worker!=task || !active || current!=sequence) return;
      worker=nil;
      id result=data.length<=800000 ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      NSString *text=@"",*reason=@"timeout";
      if ([result isKindOfClass:NSDictionary.class] && [result[@"text"] isKindOfClass:NSString.class] && [result[@"reason"] isKindOfClass:NSString.class]) { text=result[@"text"]; reason=result[@"reason"]; }
      if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=origin) { text=@"";reason=@"changed"; }
      emit(@{@"type":@"result",@"id":@(current),@"text":text,@"reason":reason,@"ms":@((CFAbsoluteTimeGetCurrent()-started)*1000)});
    });
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,1100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
    if (worker==task) { terminateWorker();emit(@{@"type":@"result",@"id":@(current),@"text":@"",@"reason":@"timeout",@"ms":@1100}); }
  });
}
static CGEventRef eventCallback(CGEventTapProxy proxy,CGEventType type,CGEventRef event,void *context) {
  if (type==kCGEventTapDisabledByTimeout || type==kCGEventTapDisabledByUserInput) { gestureReset(&gesture);if (tap&&trusted())CGEventTapEnable(tap,true);return event; }
  if (!enabled) return event;
  CGEventFlags flags=CGEventGetFlags(event);
  int key=(int)CGEventGetIntegerValueField(event,kCGKeyboardEventKeycode);
  BOOL shift=key==56||key==60;
  BOOL down=type==kCGEventKeyDown || (type==kCGEventFlagsChanged && shift && CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState,key));
  BOOL modifier=(flags&(kCGEventFlagMaskControl|kCGEventFlagMaskAlternate|kCGEventFlagMaskCommand))!=0;
  BOOL injected=CGEventGetIntegerValueField(event,kCGEventSourceUnixProcessID)!=0 || CGEventGetIntegerValueField(event,kCGKeyboardEventAutorepeat)!=0;
  if (gestureFeed(&gesture,key,down,(int64_t)(CGEventGetTimestamp(event)/1000000),modifier,injected)) dispatch_async(dispatch_get_main_queue(),^{capture();});
  return event; // Listen-only: never suppress, replace or synthesize keys.
}
static void installTap(void) {
  if (tap) { CFMachPortInvalidate(tap);CFRelease(tap);tap=NULL; }
  gestureReset(&gesture);
  if (!enabled || !trusted()) { status(); return; }
  CGEventMask mask=CGEventMaskBit(kCGEventFlagsChanged)|CGEventMaskBit(kCGEventKeyDown)|CGEventMaskBit(kCGEventKeyUp);
  tap=CGEventTapCreate(kCGSessionEventTap,kCGHeadInsertEventTap,kCGEventTapOptionListenOnly,mask,eventCallback,NULL);
  if (tap) { CFRunLoopSourceRef source=CFMachPortCreateRunLoopSource(NULL,tap,0);CFRunLoopAddSource(CFRunLoopGetMain(),source,kCFRunLoopCommonModes);CFRelease(source);CGEventTapEnable(tap,true);status(); }
  else emit(@{@"type":@"status",@"enabled":@(enabled),@"error":@"tap",@"reason":@"input-monitoring"});
}
int main(int argc,const char **argv) { @autoreleasepool {
  if (argc>1 && strcmp(argv[1],"--self-test")==0) {
    ShiftGesture g={0};gestureReset(&g);
    if(gestureFeed(&g,56,true,0,false,false)||gestureFeed(&g,56,false,20,false,false)||gestureFeed(&g,56,true,100,false,false)||!gestureFeed(&g,56,false,120,false,false))return 1;
    for(int scenario=0;scenario<5;scenario++){gestureReset(&g);gestureFeed(&g,56,true,0,false,false);gestureFeed(&g,56,false,20,false,false);if(scenario==0)gestureFeed(&g,1,true,30,false,false);gestureFeed(&g,56,true,scenario==1?400:100,scenario==2,scenario==3);if(scenario==4)gestureFeed(&g,56,true,110,false,false);if(gestureFeed(&g,56,false,scenario==1?420:120,false,false))return 1;}
    puts("gesture-tests-ok");return 0;
  }
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  if (argc==3 && strcmp(argv[1],"--read")==0) { selection((pid_t)atoi(argv[2]));return 0; }
  if (argc==4 && (strcmp(argv[1],"--focus")==0 || strcmp(argv[1],"--restore")==0)) {
    NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)atoi(argv[3])];
    if (strcmp(argv[1],"--restore")==0 && launchIdentity(app)!=atoll(argv[2]))return 1;
    BOOL requested=[app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    NSDate *until=[NSDate dateWithTimeIntervalSinceNow:0.5];while(requested&&!app.active&&until.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    if(app.active){puts("focused");return 0;}return 1;
  }
  parentProcess=getppid();executable=NSProcessInfo.processInfo.arguments[0];gestureReset(&gesture);
  emit(@{@"type":@"ready"});
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
    char *line=NULL;size_t capacity=0;
    while(getline(&line,&capacity,stdin)>0){NSString *command=[[NSString stringWithUTF8String:line] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];dispatch_async(dispatch_get_main_queue(),^{
      if([command isEqual:@"enable"]||[command isEqual:@"disable"]){enabled=[command isEqual:@"enable"];installTap();}
      else if([command isEqual:@"permissions"]){AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt:@YES});CGRequestListenEventAccess();installTap();}
      else if([command isEqual:@"capture"])capture();
      else if([command isEqual:@"cancel"]||[command isEqual:@"finish"]){terminateWorker();if([command isEqual:@"cancel"])restoreOrigin();active=NO;gestureReset(&gesture);}
      else if([command hasPrefix:@"visible:"]&&active&&[[command substringFromIndex:8] integerValue]==sequence)emit(@{@"type":@"timing",@"id":@(sequence),@"ms":@((CFAbsoluteTimeGetCurrent()-started)*1000)});
    });}
    free(line);dispatch_async(dispatch_get_main_queue(),^{terminateWorker();exit(0);});
  });
  [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *timer){
    if(getppid()!=parentProcess){terminateWorker();exit(0);}
    if(enabled&&!trusted()){if(tap){CFMachPortInvalidate(tap);CFRelease(tap);tap=NULL;}gestureReset(&gesture);status();}
  }];
  [NSApp run];terminateWorker();return 0;
} }

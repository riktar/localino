using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;

internal sealed class CaptureHelper : Form {
  delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int kind, HookProc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint size);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  // The coordinator is assigned to a kill-on-close job. Workers inherit membership;
  // even forced coordinator termination closes the job handle and kills a stuck UIA worker.
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  readonly ShiftGesture gesture = new ShiftGesture();
  readonly Stopwatch clock = Stopwatch.StartNew();
  readonly HookProc callback;
  readonly JavaScriptSerializer json = new JavaScriptSerializer();
  IntPtr hook, job, origin;
  uint originProcess;
  bool enabled, active;
  int sequence;
  Process worker;
  CaptureHelper() {
    callback = OnKey;
    ShowInTaskbar = false;
    FormBorderStyle = FormBorderStyle.None;
    Opacity = 0;
  }
  protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
  void Send(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
  bool SetupJob() {
    job = CreateJobObject(IntPtr.Zero,null);
    var info = new ExtendedLimit();info.basic.flags=0x2000;
    int size=Marshal.SizeOf(info);IntPtr data=Marshal.AllocHGlobal(size);
    try { Marshal.StructureToPtr(info,data,false);return job!=IntPtr.Zero && SetInformationJobObject(job,9,data,(uint)size) && AssignProcessToJobObject(job,Process.GetCurrentProcess().Handle); }
    finally { Marshal.FreeHGlobal(data); }
  }
  void Enable(bool value) {
    gesture.Reset();enabled=false;
    if(hook!=IntPtr.Zero){UnhookWindowsHookEx(hook);hook=IntPtr.Zero;}
    if(value) {hook=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);enabled=hook!=IntPtr.Zero;}
    Send(new { type="status", enabled=enabled, error=value&&!enabled ? "hook" : "" });
  }
  bool Modifier() {foreach(int key in new[]{0x11,0x12,0x5B,0x5C})if(GetAsyncKeyState(key)<0)return true;return false;}
  IntPtr OnKey(int code, IntPtr message, IntPtr data) {
    if(code>=0 && enabled) {
      int msg=message.ToInt32();bool down=msg==0x100||msg==0x104;
      if(down||msg==0x101||msg==0x105) {
        int key=Marshal.ReadInt32(data),flags=Marshal.ReadInt32(data,8);
        if(gesture.Feed(key,down,clock.ElapsedMilliseconds,Modifier(),(flags&0x12)!=0)) BeginInvoke(new Action(BeginCapture));
      }
    }
    return CallNextHookEx(hook,code,message,data);
  }
  async void BeginCapture() {
    gesture.Reset();
    if(active){Send(new {type="raise"});return;}
    active=true;int id=++sequence;
    origin=GetForegroundWindow();GetWindowThreadProcessId(origin,out originProcess);
    Send(new {type="begin",id=id,origin=origin.ToInt64().ToString(),pid=originProcess});
    var elapsed=Stopwatch.StartNew();
    Process running=null;
    try {
      worker=new Process {StartInfo=new ProcessStartInfo(Application.ExecutablePath,"--read " + origin.ToInt64()) {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}};
      worker.Start();running=worker;
      var read=running.StandardOutput.ReadToEndAsync();
      if(await Task.WhenAny(read,Task.Delay(1300))!=read){StopWorker(running);if(active&&sequence==id)Send(new {type="result",id=id,text="",reason="timeout",ms=elapsed.ElapsedMilliseconds});return;}
      string output=await read;
      if(!active||sequence!=id)return;
      // A worker returns one base64 UTF-8 string or one fixed error code.
      string text="",reason=output.Trim();
      if(output.StartsWith("text:")){text=Encoding.UTF8.GetString(Convert.FromBase64String(output.Substring(5)));reason=text.Length==0?"empty":"ok";}
      if(text.Length>100000){text="";reason="limit";}
      Send(new {type="result",id=id,text=text,reason=reason,ms=elapsed.ElapsedMilliseconds});
    }catch{if(active&&sequence==id)Send(new {type="result",id=id,text="",reason="unavailable",ms=elapsed.ElapsedMilliseconds});}
    finally {StopWorker(running);}
  }
  void StopWorker(Process expected){if(expected!=null&&worker==expected)StopWorker();}
  void StopWorker(){var current=worker;worker=null;if(current!=null){try{if(!current.HasExited)current.Kill();}catch{}current.Dispose();}}
  void Finish(bool restore) {
    active=false;sequence++;StopWorker();gesture.Reset();
    uint pid;GetWindowThreadProcessId(origin,out pid);
    if(restore&&origin!=IntPtr.Zero&&IsWindow(origin)&&pid==originProcess)SetForegroundWindow(origin);
    origin=IntPtr.Zero;
  }
  void Command(string command) {
    if(command=="enable")Enable(true);
    else if(command=="disable")Enable(false);
    else if(command=="capture")BeginCapture();
    else if(command=="finish")Finish(false);
    else if(command=="cancel")Finish(true);
    else if(command=="quit"){Finish(false);Enable(false);Application.ExitThread();}
  }
  void Start() {
    var handle=Handle;
    if(!SetupJob()){Send(new {type="error",reason="job"});Environment.Exit(1);return;}
    Send(new {type="ready"});
    Task.Run(()=>{string line;while((line=Console.ReadLine())!=null){if(line.Length<32)BeginInvoke(new Action<string>(Command),line);}BeginInvoke(new Action(()=>Command("quit")));});
    Application.Run();
    Finish(false);Enable(false);
  }
  static void Restore(long handle, uint expected) {
    IntPtr window=new IntPtr(handle);uint pid;GetWindowThreadProcessId(window,out pid);
    if(window!=IntPtr.Zero&&IsWindow(window)&&pid==expected)SetForegroundWindow(window);
  }
  static void ReadSelection(long handle) {
    try {
      var foreground=new IntPtr(handle);
      if(foreground==IntPtr.Zero||GetForegroundWindow()!=foreground){Console.Write("changed");return;}
      var element=AutomationElement.FocusedElement;
      // Validate the focused element belongs to the window captured at the gesture.
      if(element==null||element.Current.IsPassword){Console.Write("empty");return;}
      bool belongs=false;var ancestor=element;
      for(int depth=0;ancestor!=null&&depth<64;depth++,ancestor=TreeWalker.RawViewWalker.GetParent(ancestor)) {
        if(new IntPtr(ancestor.Current.NativeWindowHandle)==foreground){belongs=true;break;}
      }
      if(!belongs){Console.Write("changed");return;}
      string text="";
      for(int depth=0;element!=null&&depth<8;depth++,element=TreeWalker.ControlViewWalker.GetParent(element)) {
        if(element.Current.IsPassword){Console.Write("empty");return;}
        object pattern;
        if(element.TryGetCurrentPattern(TextPattern.Pattern,out pattern)) {
          var ranges=((TextPattern)pattern).GetSelection();
          if(ranges.Length==1)text=ranges[0].GetText(100001);
          if(text.Length>0)break;
        }
        if(new IntPtr(element.Current.NativeWindowHandle)==foreground)break;
      }
      if(GetForegroundWindow()!=foreground){Console.Write("changed");return;}
      if(text.Length>100000){Console.Write("limit");return;}
      Console.Write("text:"+Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
    } catch {Console.Write("unavailable");}
  }
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new UTF8Encoding(false);
    if(args.Length==3&&args[0]=="--restore"){long hwnd;uint pid;if(long.TryParse(args[1],out hwnd)&&uint.TryParse(args[2],out pid))Restore(hwnd,pid);return;}
    if(args.Length==1&&args[0]=="--self-test"){ShiftGesture.Test();return;}
    if(args.Length==2&&args[0]=="--read"){long hwnd;if(long.TryParse(args[1],out hwnd))ReadSelection(hwnd);return;}
    Application.EnableVisualStyles();using(var helper=new CaptureHelper())helper.Start();
  }
}

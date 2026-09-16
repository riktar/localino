using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// No UI, agent process, credentials, transcript persistence or external runtime.
internal static class StatusLineHelper {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool MoveFileEx(string oldPath, string newPath, int flags);
  static Dictionary<string,object> Obj(object value) { return value as Dictionary<string,object>; }
  static object Get(Dictionary<string,object> value,string key) { object result;return value!=null&&value.TryGetValue(key,out result)?result:null; }
  static Dictionary<string,object> Read(string path) { return Obj(Json.DeserializeObject(File.ReadAllText(path,Encoding.UTF8))); }
  static double? Number(object value) {
    if(value==null)return null;
    if(!(value is int||value is long||value is double||value is decimal))throw new FormatException();
    double n=Convert.ToDouble(value);if(Double.IsNaN(n)||Double.IsInfinity(n)||n<0)throw new FormatException();return n;
  }
  static string Quote(string value) {
    var result=new StringBuilder("\"");int slashes=0;
    foreach(char c in value) {if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
    result.Append('\\',slashes*2);result.Append('"');return result.ToString();
  }
  static Dictionary<string,object> Project(byte[] input,long receivedAt) {
    var data=Obj(Json.DeserializeObject(new UTF8Encoding(false,true).GetString(input)));
    var id=Get(data,"session_id") as string;if(String.IsNullOrEmpty(id)||id.Length>256)throw new FormatException();
    var windows=new List<object>();var rates=Obj(Get(data,"rate_limits"));
    foreach(string key in new[]{"five_hour","seven_day","spend_limit"}) {
      object raw=Get(rates,key);if(raw==null)continue;var window=Obj(raw);if(window==null)throw new FormatException();
      double? used=Number(Get(window,"used_percentage")),reset=Number(Get(window,"resets_at"));
      if((key!="spend_limit"&&used>100)||reset>8640000000000d)throw new FormatException();
      windows.Add(new Dictionary<string,object>{{"id",key},{"usedPercent",used},{"resetsAt",reset.HasValue?(object)(reset.Value*1000):null}});
    }
    if(Get(data,"rate_limits")!=null&&rates==null)throw new FormatException();
    var cost=Obj(Get(data,"cost"));if(Get(data,"cost")!=null&&cost==null)throw new FormatException();
    return new Dictionary<string,object>{{"sessionId",id},{"receivedAt",receivedAt},{"windows",windows},{"cost",Number(Get(cost,"total_cost_usd"))}};
  }
  static void Cache(string configPath,Dictionary<string,object> config,byte[] input,long receivedAt) {
    var snapshot=Project(input,receivedAt);
    FileStream gate=null;var watch=Stopwatch.StartNew();
    while(gate==null&&watch.ElapsedMilliseconds<120) {try{gate=new FileStream(configPath+".lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);}catch(IOException){Thread.Sleep(10);}}
    if(gate==null)return;
    using(gate) {
      var current=Read(configPath);
      if(!Object.Equals(Get(current,"enabled"),true)||!Object.Equals(Get(current,"generation"),Get(config,"generation")))return;
      string path=Get(current,"cachePath") as string;
      if(File.Exists(path)) {try{if(Convert.ToInt64(Get(Read(path),"receivedAt"))>receivedAt)return;}catch{}}
      string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
      try {File.WriteAllText(temp,Json.Serialize(snapshot),new UTF8Encoding(false));if(!MoveFileEx(temp,path,1|8))throw new IOException();}
      finally {if(File.Exists(temp))File.Delete(temp);}
    }
  }
  static int Previous(Dictionary<string,object> config,byte[] input) {
    string command=Get(Obj(Get(config,"previous")),"command") as string;
    if(String.IsNullOrEmpty(command))return 0;
    string shell=Get(config,"shell") as string;bool bash=Object.Equals(Get(config,"shellKind"),"bash");
    var start=new ProcessStartInfo(shell,bash?"-c "+Quote(command):"-NoProfile -NonInteractive -EncodedCommand "+Convert.ToBase64String(Encoding.Unicode.GetBytes(command))) {
      UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true
    };
    using(var process=Process.Start(start)) {
      var output=process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
      try {process.StandardInput.BaseStream.Write(input,0,input.Length);process.StandardInput.Close();}catch(IOException){}
      process.WaitForExit();output.GetAwaiter().GetResult();return process.ExitCode;
    }
  }
  static int Main(string[] args) {
    if(args.Length!=1)return 1;
    try {
      var config=Read(args[0]);
      byte[] input;using(var buffer=new MemoryStream()){Console.OpenStandardInput().CopyTo(buffer);input=buffer.ToArray();}
      long receivedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      try {if(Object.Equals(Get(config,"enabled"),true)&&input.Length<=8*1024*1024)Cache(args[0],config,input,receivedAt);}catch{}
      return Previous(config,input);
    }catch{return 1;}
  }
}

// Test-only protocol fixture. It does not install hooks or inspect any application.
using System;
using System.IO;
using System.Web.Script.Serialization;
class Fixture {
  static void Main(string[] args) {
    if(args.Length>0 && args[0]=="--focus"){Console.WriteLine("focused");return;}
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    var json=new JavaScriptSerializer();int id=0;bool active=false;
    Action<object> send=value=>{Console.WriteLine(json.Serialize(value));Console.Out.Flush();};
    send(new {type="ready"});string line;
    while((line=Console.ReadLine())!=null){
      if(line=="enable"||line=="disable")send(new {type="status",enabled=line=="enable",error=""});
      else if(line=="capture"){
        if(active){send(new {type="raise"});continue;}
        active=true;id++;send(new {type="begin",id=id});
        string mode=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"mode.txt");
        bool empty=File.Exists(mode)&&File.ReadAllText(mode)=="empty";
        send(new {type="result",id=id,text=empty?"":"Prova Localino \ud83c\udf31\nSeconda riga \u00e8 \u6f22\u5b57",reason=empty?"empty":"ok",ms=5});
      }
      else if(line.StartsWith("visible:"))send(new {type="timing",id=id,ms=42});
      else if(line=="finish"||line=="cancel")active=false;
      else if(line=="quit")return;
    }
  }
}

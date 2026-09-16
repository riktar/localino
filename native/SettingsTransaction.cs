using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Compare and update one settings key in an NTFS transaction. No full-settings
// backup file is created; unsupported filesystems fail without a fallback write.
internal static class SettingsTransaction {
  [DllImport("KtmW32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern IntPtr CreateTransaction(IntPtr attributes,IntPtr guid,uint options,uint isolation,uint flags,uint timeout,string description);
  [DllImport("KtmW32.dll",SetLastError=true)] static extern bool CommitTransaction(IntPtr transaction);
  [DllImport("KtmW32.dll",SetLastError=true)] static extern bool RollbackTransaction(IntPtr transaction);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern SafeFileHandle CreateFileTransacted(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template,IntPtr transaction,IntPtr version,IntPtr extended);
  internal static int Run() {
    IntPtr transaction=IntPtr.Zero;bool committed=false;
    try {
      var json=new JavaScriptSerializer {MaxJsonLength=8*1024*1024};
      Dictionary<string,object> request;
      using(var input=new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false,true)))request=json.DeserializeObject(input.ReadToEnd()) as Dictionary<string,object>;
      string path=Path.GetFullPath((string)request["path"]),expected=(string)request["expectedHash"];
      if(!path.StartsWith("\\\\?\\"))path="\\\\?\\"+path;
      transaction=CreateTransaction(IntPtr.Zero,IntPtr.Zero,0,0,0,4000,"Localino statusLine update");
      if(transaction==IntPtr.Zero||transaction==new IntPtr(-1)){Console.Error.WriteLine("settings-transaction:"+Marshal.GetLastWin32Error());return 3;}
      // Deny writers and renames until the transaction has committed; readers
      // see the prior committed version. Competing transactions conflict.
      using(var handle=CreateFileTransacted(path,0xC0000000,1,IntPtr.Zero,4,128,IntPtr.Zero,transaction,IntPtr.Zero,IntPtr.Zero)) {
        if(handle.IsInvalid){Console.Error.WriteLine("settings-open:"+Marshal.GetLastWin32Error());return 3;}
        using(var file=new FileStream(handle,FileAccess.ReadWrite)) {
          if(file.Length>8*1024*1024)return 4;
          byte[] bytes;using(var memory=new MemoryStream()){file.CopyTo(memory);bytes=memory.ToArray();}
          string hash;using(var sha=SHA256.Create()){hash=BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
          if(hash!=expected)return 2;
          var value=bytes.Length==0?new Dictionary<string,object>():json.DeserializeObject(new UTF8Encoding(false,true).GetString(bytes).TrimStart('\uFEFF')) as Dictionary<string,object>;
          if(value==null)return 4;
          if((bool)request["remove"])value.Remove("statusLine");else value["statusLine"]=request["statusLine"];
          var replacement=new UTF8Encoding(false).GetBytes(json.Serialize(value)+"\n");
          file.Position=0;file.Write(replacement,0,replacement.Length);file.SetLength(replacement.Length);file.Flush(true);
          if(!CommitTransaction(transaction)){Console.Error.WriteLine("settings-commit:"+Marshal.GetLastWin32Error());return 3;}
          committed=true;return 0;
        }
      }
    }catch(Exception error){Console.Error.WriteLine("settings-error:"+error.GetType().Name);return 3;}
    finally{if(transaction!=IntPtr.Zero&&transaction!=new IntPtr(-1)){if(!committed)RollbackTransaction(transaction);CloseHandle(transaction);}}
  }
}

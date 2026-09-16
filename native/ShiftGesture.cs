using System;

// No key history: only the state of the current two-tap gesture is retained.
internal sealed class ShiftGesture {
  long first = -1, pressedAt;
  int held;
  bool invalid;
  internal void Reset() { first = -1; held = 0; invalid = false; }
  internal bool Feed(int key, bool down, long now, bool modifier, bool injected) {
    if (injected) { Reset(); return false; }
    if (key != 0xA0 && key != 0xA1 && key != 0x10) {
      first = -1; if (held != 0) invalid = true; return false;
    }
    if (down) {
      if (held != 0) { invalid = true; first = -1; return false; }
      held = key; pressedAt = now; invalid = modifier;
      if (modifier || (first >= 0 && now - first > 350)) first = -1;
      return false;
    }
    if (held != key) { Reset(); return false; }
    held = 0;
    if (invalid || modifier || now - pressedAt > 350) { first = -1; invalid = false; return false; }
    if (first >= 0 && now - first <= 350) { Reset(); return true; }
    first = pressedAt; return false;
  }
  internal static void Test() {
    int assertions = 0;
    Action<bool> check = value => { assertions++; if (!value) throw new Exception("Gesture assertion " + assertions); };
    var g = new ShiftGesture();
    check(!g.Feed(160,true,0,false,false)); check(!g.Feed(160,false,20,false,false));
    check(!g.Feed(160,true,200,false,false)); check(g.Feed(160,false,350,false,false));
    check(!g.Feed(160,false,360,false,false));
    foreach (int scenario in new[]{0,1,2,3,4,5,6}) {
      g.Reset(); g.Feed(160,true,0,false,false);
      if (scenario == 0) g.Feed(160,true,10,false,false); // repeat
      if (scenario == 1) g.Feed(65,true,10,false,false); // Shift + letter
      if (scenario == 2) g.Feed(161,true,10,false,false); // both Shifts
      if (scenario == 3) g.Feed(160,false,10,false,true); // injected release
      check(!g.Feed(160,false,scenario==4?400:20,false,false));
      check(!g.Feed(160,true,scenario==4?450:scenario==5?351:40,scenario==6,false));
      check(!g.Feed(160,false,scenario==4?500:scenario==5?360:60,scenario==6,false));
    }
    g.Reset();g.Feed(160,true,0,false,false);g.Feed(160,false,10,false,false);
    g.Feed(65,true,20,false,false);g.Feed(65,false,30,false,false);
    g.Feed(160,true,40,false,false);check(!g.Feed(160,false,50,false,false));
    g.Reset();g.Feed(161,true,0,false,false);g.Feed(161,false,10,false,false);
    g.Feed(161,true,30,true,false);check(!g.Feed(161,false,40,false,false));
    Console.WriteLine("gesture-tests-ok " + assertions);
  }
}

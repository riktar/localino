#include <stdbool.h>
#include <stdint.h>
typedef struct { int64_t first, pressed; int held; bool invalid; } ShiftGesture;
static void gestureReset(ShiftGesture *g) { g->first = -1; g->held = 0; g->invalid = false; }
/* Retain only a two-tap state, never a key history. key: 56/60 = left/right Shift. */
static bool gestureFeed(ShiftGesture *g, int key, bool down, int64_t now, bool modifier, bool injected) {
  if (injected) { gestureReset(g); return false; }
  if (key != 56 && key != 60) { g->first = -1; if (g->held) g->invalid = true; return false; }
  if (down) {
    if (g->held) { g->invalid = true; g->first = -1; return false; }
    g->held = key; g->pressed = now; g->invalid = modifier;
    if (modifier || (g->first >= 0 && now - g->first > 350)) g->first = -1;
    return false;
  }
  if (g->held != key) { gestureReset(g); return false; }
  g->held = 0;
  if (g->invalid || modifier || now - g->pressed > 350) { g->first = -1; g->invalid = false; return false; }
  if (g->first >= 0 && now - g->first <= 350) { gestureReset(g); return true; }
  g->first = g->pressed; return false;
}

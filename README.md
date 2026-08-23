3tap habit reorder polish

- smoother drag-to-reorder on desktop + mobile
- vertical-intent thresholds prevent accidental drags
- horizontal movement in the habit rail cancels reorder instead of fighting the UI
- fixed 48px geometry avoids repeated DOM measurements while dragging
- surrounding rows move one slot at a time for predictable ordering
- dragging near the top/bottom auto-scrolls long habit lists
- remote sync pauses during an active drag, then saves once on drop
- zero-state + habit row remains excluded from timeline panning
- floating drag preview uses GPU transform instead of changing layout position every frame

Apply from the 3tap project root:
  unzip -o ~/Downloads/3tap-reorder-smooth-patch.zip
  npm run check
  npm run dev

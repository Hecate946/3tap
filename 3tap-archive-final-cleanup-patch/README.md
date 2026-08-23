Changes:
- remove archive count badge
- remove Share icon and all Share functionality
- enlarge remaining toolbar icons slightly
- use four evenly spaced toolbar actions: add device, archive, recovery, theme
- clean Archive panel layout and give Archive its own non-overlapping close control
- hide Archive panel scrollbar while preserving wheel/touch scrolling
- fix permanent delete confirmation so successful deletion returns to Archive immediately
- show a useful error if delete/clear is rejected instead of leaving a dead confirmation state

Apply from the 3tap project root:

unzip -o ~/Downloads/3tap-archive-final-cleanup-patch.zip
npm run dev

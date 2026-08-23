3tap month dropdown anchor + label sync fix

Changes:
- month label now uses explicit synchronized display state, so clicking a month updates the visible label immediately
- month dropdown is anchored directly to the month button instead of the navbar slot
- dropdown width exactly matches the AUG underline/button width
- dropdown begins immediately below the month underline
- month/year/timeline scrolling stay synchronized

Apply from project root:
  unzip -o ~/Downloads/3tap-month-anchor-sync-fix.zip
  npm run dev

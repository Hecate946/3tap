3tap clean-slate + palette patch

Changes:
- Today accent is more turquoise in light and dark mode.
- Dark mode uses a cooler charcoal palette instead of the prior brown/olive cast.
- New boards start with zero habits; all starter habits were removed from board creation.
- Includes a one-time production migration that permanently deletes ALL existing boards, habits, and entries.
- Includes a matching one-time browser cache reset so deleted starter boards do not remain visible from localStorage.

IMPORTANT: 20260823095000_clean_slate_reset.sql is intentionally destructive and runs once through the normal Supabase migration pipeline.

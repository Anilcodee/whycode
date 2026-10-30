# WhyCode workspace setup

## Account storage enable karein

1. Supabase dashboard mein apna WhyCode project kholiye.
2. **SQL Editor → New query** kholiye.
3. Repository ki `supabase/migrations/20261030_account_investigations.sql` file ka poora content copy karke query editor mein paste karein.
4. SQL review karke **Run** dabaiye. Yeh account-owned repositories aur investigations ke liye tables aur row-level access policies banata hai.
5. WhyCode mein sign in karke public repository aur question test karein. Reload ya dobara sign in karke history check karein. Private repository ke liye GitHub access aur private-data consent bhi zaroori hai.

Is setup ke liye `.env` mein naya service-role key nahi chahiye. Existing Supabase URL aur public anon/publishable key use hote hain. Migration apply na ho ya database unavailable ho toh app warning dikhata hai aur naya work temporary ho sakta hai.

## Data kahan rehta hai?

- **Guest:** PostgreSQL aur encryption configured ho toh repository list aur answers encrypted temporary database storage mein rehte hain aur restart ke baad bhi eight-hour expiry tak available hote hain. Configuration ke bina earlier server-memory behavior use hota hai. Alag browser profiles ke guest sessions alag hain; ek hi browser profile use karne wale log session share kar sakte hain.
- **Signed-in user:** repository references aur saved answers Supabase mein us account ke liye store hote hain. Answers mein source excerpts ho sakte hain. Configured runtime mein private indexes bhi encrypted PostgreSQL storage mein rehte hain, current login/GitHub access aur expiry ke scope mein. Interrupted private work current GitHub permission check ke baad recover hota hai.
- **Shared public index:** public repository ka source index reuse ho sakta hai, lekin workspace lists aur investigations alag hain. Apne workspace se repository hatane se shared public index ya GitHub repository delete nahi hoti.
- **Purani browser history:** apne aap import ya delete nahi hoti. Sign in ke baad user ko explicitly import karne ka option milta hai. Shared device par import karne se pehle check karein ki history aapki hi hai.

Repository ya investigation ko workspace ke delete controls se hata sakte hain. Account se sign out karna saved work ya account delete nahi karta. Session aur temporary in-memory storage single server process par depend karte hain; multi-server production deployment ke liye shared sessions aur durable job infrastructure abhi alag kaam hai.

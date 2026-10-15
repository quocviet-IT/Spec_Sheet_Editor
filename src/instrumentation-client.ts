import * as z from "zod";

// Runs in the browser before the app starts. The Content-Security-Policy forbids eval; on its first parse Zod 4
// would probe for it with Function(""), which the browser blocks and reports as a policy violation on every page.
// Without the probe Zod validates the same way, only without compiling its object checks.
z.config({ jitless: true });

import {TaskGuard, type Scope} from "agent-permission-revocation-lab";
declare const scope: Scope;
const guard = new TaskGuard();
const result: number = guard.run("grant",scope,()=>42);
// @ts-expect-error Missing scope fields.
guard.grant({task:"t"},123);
// @ts-expect-error Return type follows callback.
const invalid: string = guard.run("grant",scope,()=>42);

import type { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";
declare const sqlite: SqliteTaskGuard;
const sqliteResult: number = sqlite.run("grant", scope, () => 42);
// @ts-expect-error The transaction callback must return synchronously.
sqlite.run("grant", scope, async () => 42);

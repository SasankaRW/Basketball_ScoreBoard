/**
 * Cloud Functions entry point.
 *
 * Everything here exists because it needs privileges no client may hold: setting
 * auth custom claims, generating and hashing viewer keys, or writing the
 * append-only audit log. Anything that does not need those privileges is a
 * direct client read or write governed by the security rules instead.
 */
export { provisionTenant } from './tenants.js';
export { createBoard, deleteBoard, rotateViewerKey } from './boards.js';
export { exchangeViewerKey } from './viewerKeys.js';
export { acceptInvite, inviteMember, removeMember, setMemberRole } from './members.js';
export { finishMatch, startScheduledMatch } from './matches.js';
export { onBoardStateWritten } from './audit.js';

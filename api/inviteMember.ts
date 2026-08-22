import { withAuth } from '../src/server/http.js';
import { inviteMember, InviteMemberInput } from '../src/server/members.js';

export default withAuth('admin', InviteMemberInput, inviteMember);

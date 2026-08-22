import { withAuth } from '../src/server/http.js';
import { acceptInvite, AcceptInviteInput } from '../src/server/members.js';

export default withAuth('signed-in', AcceptInviteInput, acceptInvite);

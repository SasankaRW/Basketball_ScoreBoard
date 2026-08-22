import { withAuth } from '../src/server/http.js';
import { removeMember, RemoveMemberInput } from '../src/server/members.js';

export default withAuth('admin', RemoveMemberInput, removeMember);

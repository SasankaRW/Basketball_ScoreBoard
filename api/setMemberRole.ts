import { withAuth } from '../src/server/http.js';
import { setMemberRole, SetMemberRoleInput } from '../src/server/members.js';

export default withAuth('admin', SetMemberRoleInput, setMemberRole);

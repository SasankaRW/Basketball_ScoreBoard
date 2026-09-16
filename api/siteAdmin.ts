import { withAuth } from '../src/server/http.js';
import { handleSiteAdminAction, SiteAdminActionInput } from '../src/server/siteAdmin.js';

export default withAuth('signed-in', SiteAdminActionInput, handleSiteAdminAction);

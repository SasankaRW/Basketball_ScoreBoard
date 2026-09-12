import { withAuth } from '../src/server/http.js';
import { getSiteAdminOverview, SiteAdminOverviewInput } from '../src/server/siteAdmin.js';

export default withAuth('signed-in', SiteAdminOverviewInput, getSiteAdminOverview);

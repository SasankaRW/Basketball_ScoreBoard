import { withAuth } from '../src/server/http.js';
import { provisionTenant, ProvisionInput } from '../src/server/tenants.js';

export default withAuth('signed-in', ProvisionInput, provisionTenant);

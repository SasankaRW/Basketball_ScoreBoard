import { withAuth } from '../src/server/http.js';
import { handleLogoAction, LogoActionInput } from '../src/server/logo.js';

export default withAuth('admin', LogoActionInput, handleLogoAction);

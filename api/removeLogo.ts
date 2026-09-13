import { withAuth } from '../src/server/http.js';
import { removeLogo, RemoveLogoInput } from '../src/server/logo.js';

export default withAuth('admin', RemoveLogoInput, removeLogo);

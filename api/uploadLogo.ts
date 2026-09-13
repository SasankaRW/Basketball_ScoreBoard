import { withAuth } from '../src/server/http.js';
import { uploadLogo, UploadLogoInput } from '../src/server/logo.js';

export default withAuth('admin', UploadLogoInput, uploadLogo);

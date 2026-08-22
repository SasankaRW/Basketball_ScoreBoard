import { withAuth } from '../src/server/http.js';
import { exchangeViewerKey, ExchangeViewerKeyInput } from '../src/server/viewerKeys.js';

export default withAuth('public', ExchangeViewerKeyInput, exchangeViewerKey);

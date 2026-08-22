import { withAuth } from '../src/server/http.js';
import { rotateViewerKey, RotateViewerKeyInput } from '../src/server/boards.js';

export default withAuth('admin', RotateViewerKeyInput, rotateViewerKey);

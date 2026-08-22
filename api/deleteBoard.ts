import { withAuth } from '../src/server/http.js';
import { deleteBoard, BoardRefInput } from '../src/server/boards.js';

export default withAuth('admin', BoardRefInput, deleteBoard);

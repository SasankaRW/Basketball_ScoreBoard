import { withAuth } from '../src/server/http.js';
import { createBoard, CreateBoardInput } from '../src/server/boards.js';

export default withAuth('admin', CreateBoardInput, createBoard);

import { withAuth } from '../src/server/http.js';
import { finishMatch, FinishMatchInput } from '../src/server/matches.js';

export default withAuth('operator', FinishMatchInput, finishMatch);

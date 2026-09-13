import { withAuth } from '../src/server/http.js';
import { handleMatchAction, MatchActionInput } from '../src/server/matches.js';

export default withAuth('operator', MatchActionInput, handleMatchAction);

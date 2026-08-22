import { withAuth } from '../src/server/http.js';
import { startScheduledMatch, StartScheduledMatchInput } from '../src/server/matches.js';

export default withAuth('operator', StartScheduledMatchInput, startScheduledMatch);

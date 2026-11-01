/** First import in the game: every module after this reads the installed tables. */
import { installShippedThemes } from './boot';

installShippedThemes();

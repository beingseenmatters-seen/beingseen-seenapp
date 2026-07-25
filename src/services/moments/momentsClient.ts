/**
 * App-wired Moments service singleton: localStorage persistence, scoped to the
 * signed-in Firebase uid. Pages and components import this; the pure service
 * (`momentsService.ts`) stays framework-free and fully testable.
 */

import { auth } from '../firebase';
import { LocalStorageStore, MomentsService } from './momentsService';

export const momentsClient = new MomentsService(
  new LocalStorageStore(),
  () => auth.currentUser?.uid ?? null,
);

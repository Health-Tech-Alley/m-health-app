import { configureStore } from '@reduxjs/toolkit';
import messagesReducer from './reducers/messagesSlice';
import nonEmergencyDecisionReducer from './reducers/nonEmergencyDecisionSlice';

export const store = configureStore({
  reducer: {
    nonEmergencyDecision: nonEmergencyDecisionReducer,
    messages: messagesReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

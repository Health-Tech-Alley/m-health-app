import { configureStore } from '@reduxjs/toolkit';
import messagesReducer from './reducers/messagesSlice';
import nonEmergencyDecisionReducer from './reducers/nonEmergencyDecisionSlice';
import patientReducer from './reducers/patientSlice';
import vitalsReducer from './reducers/vitalsSlice';

export const store = configureStore({
  reducer: {
    nonEmergencyDecision: nonEmergencyDecisionReducer,
    messages: messagesReducer,
    vitals: vitalsReducer,
    patient: patientReducer
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

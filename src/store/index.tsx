import { configureStore } from '@reduxjs/toolkit';
import nonEmergencyDecisionReducer from './reducers/nonEmergencyDecisionSlice';
import patientReducer from './reducers/patientSlice';

export const store = configureStore({
  reducer: {
    patient: patientReducer,
    nonEmergencyDecision: nonEmergencyDecisionReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

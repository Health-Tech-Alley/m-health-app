import { configureStore } from '@reduxjs/toolkit';
import patientReducer from './reducers/patientSlice';
import vitalsReducer from './reducers/vitalsSlice';

export const store = configureStore({
  reducer: {
    patient: patientReducer,
    vitals: vitalsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
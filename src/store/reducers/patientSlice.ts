import { createSlice } from "@reduxjs/toolkit";

const initialState: any = {
  patient: null,
  loading: false,
  error: null,
  lastSynced: null,
};

const patientSlice = createSlice({
  name: 'patient',
  initialState,
  reducers: {
    addPatient: (state, action) => {
      state.patient = action.payload;
      state.error = null;
      state.lastSynced = new Date().toISOString();
    },
    clearPatient: (state) => {
      state.patient = null;
      state.error = null;
      state.lastSynced = null;
    },
    clearError: (state) => {
      state.error = null;
    },
    getPatient: (state) => {
      state.loading = true;
      state.error = null;
    }
  },
});

export const { addPatient, clearPatient, clearError, getPatient } = patientSlice.actions;
export default patientSlice.reducer;
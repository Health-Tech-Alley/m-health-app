import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { CoreVitals, ExtendedVitals, MLResult } from '@/ml-models/alert-autoencoder/types';
import type { AlertMlModel } from '@/ml-models/alert-autoencoder';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VitalsSnapshot {
  core: CoreVitals;
  extended: ExtendedVitals;
  timestamp: string; // ISO string
  patientId: string;
}

export type InferenceStatus = 'idle' | 'running' | 'success' | 'error';

export interface VitalsState {
  /** Most recent vitals snapshot committed to state */
  current: VitalsSnapshot | null;

  /** Rolling history — newest first, capped at HISTORY_LIMIT */
  history: VitalsSnapshot[];

  /** Latest ML inference result */
  inferenceResult: MLResult | null;

  /** Whether an inference is currently in-flight */
  inferenceStatus: InferenceStatus;

  /** Last inference error message, if any */
  inferenceError: string | null;

  /** Whether the ML model has been loaded */
  modelLoaded: boolean;

  /** Timestamp (ISO) of the last successful inference */
  lastInferenceAt: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HISTORY_LIMIT = 100;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: VitalsState = {
  current: null,
  history: [],
  inferenceResult: null,
  inferenceStatus: 'idle',
  inferenceError: null,
  modelLoaded: false,
  lastInferenceAt: null,
};

// ─── Async Thunks ─────────────────────────────────────────────────────────────

/**
 * Load the ML model. Call once at app startup (or after a release).
 */
export const loadModel = createAsyncThunk<void, AlertMlModel>(
  'vitals/loadModel',
  async (model) => {
    await model.load();
  }
);

/**
 * Release the ML model. Call on app teardown or when vitals monitoring stops.
 */
export const releaseModel = createAsyncThunk<void, AlertMlModel>(
  'vitals/releaseModel',
  async (model) => {
    await model.release();
  }
);

/**
 * Run inference against the loaded ML model using the current vitals snapshot.
 *
 * Usage:
 *   dispatch(runInference({ model, snapshot }))
 *
 * The thunk reads core + extended vitals from the snapshot and forwards
 * them — plus an optional Date — to model.runInference().
 */
export const runInference = createAsyncThunk<
  MLResult,
  { model: AlertMlModel; snapshot: VitalsSnapshot },
  { rejectValue: string }
>(
  'vitals/runInference',
  async ({ model, snapshot }, { rejectWithValue }) => {
    if (!model.isLoaded) {
      return rejectWithValue('ML model is not loaded. Call loadModel() first.');
    }

    try {
      const result = await model.runInference(
        snapshot.core,
        snapshot.extended,
        new Date(snapshot.timestamp)
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rejectWithValue(`Inference failed: ${message}`);
    }
  }
);

/**
 * Convenience thunk: commit a new snapshot AND immediately run inference.
 *
 * Dispatches setVitals internally so you only need one dispatch from
 * the caller when you want both effects.
 */
export const setVitalsAndInfer = createAsyncThunk<
  MLResult,
  { model: AlertMlModel; snapshot: VitalsSnapshot },
  { rejectValue: string }
>(
  'vitals/setVitalsAndInfer',
  async ({ model, snapshot }, { dispatch, rejectWithValue }) => {
    dispatch(vitalsSlice.actions.setVitals(snapshot));

    const result = await dispatch(runInference({ model, snapshot }));

    if (runInference.fulfilled.match(result)) {
      return result.payload;
    }

    return rejectWithValue(
      (result.payload as string) ?? 'setVitalsAndInfer: unknown error'
    );
  }
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const vitalsSlice = createSlice({
  name: 'vitals',
  initialState,
  reducers: {
    /**
     * Commit a new vitals snapshot.
     * Pushes the previous snapshot into history (if one exists) and updates
     * `current`. Oldest entries are pruned when HISTORY_LIMIT is exceeded.
     */
    setVitals(state, action: PayloadAction<VitalsSnapshot>) {
      if (state.current) {
        state.history.unshift(state.current);
        if (state.history.length > HISTORY_LIMIT) {
          state.history.length = HISTORY_LIMIT;
        }
      }
      state.current = action.payload;
    },

    /**
     * Patch only the CoreVitals fields of the current snapshot.
     * No-ops silently if there is no current snapshot yet.
     */
    updateCoreVitals(state, action: PayloadAction<Partial<CoreVitals>>) {
      if (state.current) {
        state.current.core = { ...state.current.core, ...action.payload };
      }
    },

    /**
     * Patch only the ExtendedVitals fields of the current snapshot.
     * No-ops silently if there is no current snapshot yet.
     */
    updateExtendedVitals(state, action: PayloadAction<Partial<ExtendedVitals>>) {
      if (state.current) {
        state.current.extended = { ...state.current.extended, ...action.payload };
      }
    },

    /** Clear the most recent inference result and reset status to idle. */
    clearInferenceResult(state) {
      state.inferenceResult = null;
      state.inferenceStatus = 'idle';
      state.inferenceError = null;
    },

    /** Wipe the entire vitals history (current snapshot is preserved). */
    clearHistory(state) {
      state.history = [];
    },

    /** Full reset — useful for patient logout or session teardown. */
    resetVitals() {
      return initialState;
    },
  },

  extraReducers: (builder) => {
    // ── loadModel ──────────────────────────────────────────────────────────
    builder
      .addCase(loadModel.fulfilled, (state) => {
        state.modelLoaded = true;
      })
      .addCase(loadModel.rejected, (state) => {
        state.modelLoaded = false;
      });

    // ── releaseModel ───────────────────────────────────────────────────────
    builder.addCase(releaseModel.fulfilled, (state) => {
      state.modelLoaded = false;
    });

    // ── runInference ───────────────────────────────────────────────────────
    builder
      .addCase(runInference.pending, (state) => {
        state.inferenceStatus = 'running';
        state.inferenceError = null;
      })
      .addCase(runInference.fulfilled, (state, action) => {
        state.inferenceStatus = 'success';
        state.inferenceResult = action.payload;
        state.lastInferenceAt = new Date().toISOString();
        state.inferenceError = null;
      })
      .addCase(runInference.rejected, (state, action) => {
        state.inferenceStatus = 'error';
        state.inferenceError = action.payload ?? 'Unknown inference error';
      });

    // ── setVitalsAndInfer — mirror inference status only (setVitals is
    //    handled by the internal synchronous dispatch)
    builder
      .addCase(setVitalsAndInfer.pending, (state) => {
        state.inferenceStatus = 'running';
        state.inferenceError = null;
      })
      .addCase(setVitalsAndInfer.rejected, (state, action) => {
        state.inferenceStatus = 'error';
        state.inferenceError = action.payload ?? 'Unknown error in setVitalsAndInfer';
      });
    // fulfilled is already handled by runInference.fulfilled above
  },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

export const {
  setVitals,
  updateCoreVitals,
  updateExtendedVitals,
  clearInferenceResult,
  clearHistory,
  resetVitals,
} = vitalsSlice.actions;

export default vitalsSlice.reducer;

// ─── Selectors ────────────────────────────────────────────────────────────────

import type { RootState } from '@/store'; // adjust path to your store

export const selectCurrentVitals = (state: RootState) => state.vitals.current;
export const selectCoreVitals    = (state: RootState) => state.vitals.current?.core ?? null;
export const selectExtendedVitals= (state: RootState) => state.vitals.current?.extended ?? null;
export const selectVitalsHistory = (state: RootState) => state.vitals.history;
export const selectInferenceResult  = (state: RootState) => state.vitals.inferenceResult;
export const selectInferenceStatus  = (state: RootState) => state.vitals.inferenceStatus;
export const selectInferenceError   = (state: RootState) => state.vitals.inferenceError;
export const selectModelLoaded      = (state: RootState) => state.vitals.modelLoaded;
export const selectLastInferenceAt  = (state: RootState) => state.vitals.lastInferenceAt;
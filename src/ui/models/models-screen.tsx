import { useCallback, useEffect, useMemo, useReducer } from 'react';

import { createModelsController } from './models-controller';
import type { ModelsAction, ModelsState } from './types';
import { ModelsView } from './models-view';

const initialState: ModelsState = {
  items: [],
  hfToken: '',
  hfTokenSaved: false,
  hfTokenMasked: true,
};

function reducer(state: ModelsState, action: ModelsAction): ModelsState {
  switch (action.type) {
    case 'noop':
      return state;

    case 'set-items':
      return {
        ...state,
        items: action.payload.items,
      };

    case 'download-start':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.payload.modelId
            ? { ...item, status: 'downloading' as const, downloadProgress: 0, downloadTotal: 0, error: null }
            : item,
        ),
      };

    case 'download-progress':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.payload.modelId
            ? {
                ...item,
                downloadProgress: action.payload.bytesWritten,
                downloadTotal: action.payload.totalBytes,
              }
            : item,
        ),
      };

    case 'download-complete':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.payload.modelId
            ? { ...item, status: 'installed' as const, downloadProgress: 0, downloadTotal: 0, error: null }
            : item,
        ),
      };

    case 'download-error':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.payload.modelId
            ? { ...item, status: 'error' as const, error: action.payload.error, downloadProgress: 0, downloadTotal: 0 }
            : item,
        ),
      };

    case 'delete-complete':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.payload.modelId
            ? { ...item, status: 'not-installed' as const, downloadProgress: 0, downloadTotal: 0, error: null }
            : item,
        ),
      };

    case 'set-hf-token':
      return {
        ...state,
        hfToken: action.payload.token,
        hfTokenSaved: false,
      };

    case 'save-hf-token-success':
      return {
        ...state,
        hfTokenSaved: true,
      };

    case 'save-hf-token-error':
      return state;

    case 'toggle-hf-token-mask':
      return {
        ...state,
        hfTokenMasked: !state.hfTokenMasked,
      };

    default:
      return state;
  }
}

export function ModelsScreen() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controller = useMemo(() => createModelsController(), []);

  useEffect(() => {
    controller.setDispatchRef(dispatch);
    controller.init().then((action) => {
      dispatch(action);
    });
  }, [controller]);

  const wrappedDispatch = useCallback(
    (action: ModelsAction) => {
      dispatch(action);
    },
    [],
  );

  return <ModelsView state={state} dispatch={wrappedDispatch} controller={controller} />;
}

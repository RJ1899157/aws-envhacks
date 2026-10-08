import { useEffect, useRef } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { usePlacementIssuesStore } from '../store/placementIssuesStore';
import { validateAllObjects } from '../core/placementValidator';

/**
 * Recomputes placement issues whenever room objects, outline, or openings change,
 * debounced by 100ms off the hot path.
 */
export function usePlacementValidation(): void {
  const room = useSceneStore((state) => state.room);
  const setIssues = usePlacementIssuesStore((state) => state.setIssues);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const issues = validateAllObjects(room);
      setIssues(issues);
    }, 100);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [room, setIssues]);
}

export default usePlacementValidation;

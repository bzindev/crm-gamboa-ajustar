/**
 * Posição fracionária para reordenar cards do kanban sem reescrever a
 * coluna inteira: soltar entre A e B grava o meio dos dois; nas pontas,
 * ±1 do vizinho mais próximo. Só a linha movida muda.
 */
export function calculateNewPosition(prevPosition: number | null, nextPosition: number | null): number {
  if (prevPosition === null && nextPosition === null) {
    return 0;
  }
  if (prevPosition === null) {
    return nextPosition! - 1;
  }
  if (nextPosition === null) {
    return prevPosition + 1;
  }
  return (prevPosition + nextPosition) / 2;
}

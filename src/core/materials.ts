export const getFloorMaterialProps = (materialType: string) => {
  switch (materialType) {
    case 'wood':
      return { color: '#8b5a2b', roughness: 0.6, metalness: 0.1 };
    case 'tile':
      return { color: '#e2e8f0', roughness: 0.2, metalness: 0.1 };
    case 'concrete':
      return { color: '#9ca3af', roughness: 0.9, metalness: 0.0 };
    case 'carpet':
      return { color: '#475569', roughness: 1.0, metalness: 0.0 };
    default:
      return { color: '#27272a', roughness: 0.8, metalness: 0 };
  }
};

export const getWallMaterialProps = (materialType: string, baseColor: string) => {
  switch (materialType) {
    case 'brick':
      return { color: '#991b1b', roughness: 0.9, metalness: 0.0 };
    case 'wallpaper':
      return { color: baseColor, roughness: 0.5, metalness: 0.1 };
    case 'paint':
    default:
      return { color: baseColor, roughness: 0.7, metalness: 0.05 };
  }
};

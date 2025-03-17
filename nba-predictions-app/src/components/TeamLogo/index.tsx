import React, { useState } from 'react';
import { getTeamLogo } from '../../utils/formatters';

interface TeamLogoProps {
  teamName: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function TeamLogo({ teamName, size = 'md' }: TeamLogoProps) {
  const [imageError, setImageError] = useState(false);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  const logoUrl = getTeamLogo(teamName);
  
  // Create a color based on team name for consistent placeholder colors
  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
      const value = (hash >> (i * 8)) & 0xFF;
      color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
  };
  
  const bgColor = stringToColor(teamName);
  const textColor = '#ffffff';
  
  if (logoUrl && !imageError) {
    return (
      <img
        src={logoUrl}
        alt={`${teamName} logo`}
        className={`${sizeClasses[size]} object-contain`}
        onError={() => setImageError(true)}
      />
    );
  }
  
  // Custom placeholder with team initials
  const initials = teamName
    .split(' ')
    .map(part => part[0])
    .join('')
    .substring(0, 3);
    
  return (
    <div 
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-sm`}
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {initials}
    </div>
  );
}
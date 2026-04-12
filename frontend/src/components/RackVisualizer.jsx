import { useState, useEffect } from 'react';
import api from '../api/client';

export default function RackVisualizer({ rackId, currentItemId, currentUStart, currentUSize, onSelectU }) {
  const [items, setItems] = useState([]);
  const [rackDetails, setRackDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(8);

  const actualRackId = (rackId && typeof rackId === 'object') ? rackId.id : rackId;

  useEffect(() => {
    if (!actualRackId) {
      setItems([]);
      setRackDetails(null);
      return;
    }
    
    api.get(`/infrastructure/racks/${actualRackId}/`)
      .then(res => setRackDetails(res))
      .catch(() => {});

    setLoading(true);
    api.get(`/inventory/items/?rack=${actualRackId}`)
      .then(res => setItems(res?.results || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [actualRackId]);

  if (!actualRackId) return null;
  if (loading || !rackDetails) return <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading cabinet layout...</div>;

  const totalUs = rackDetails?.total_units || 42;
  const uSize = parseInt(currentUSize, 10) || 1;
  const currentStartNum = parseInt(currentUStart, 10);
  const itemsMap = {};
  const collisionUs = new Set();
  
  items.forEach(inv => {
    if (inv.id === currentItemId) return;
    if (inv.rack_unit_start && inv.status === 'active') {
      const start = parseInt(inv.rack_unit_start, 10);
      const size = parseInt(inv.rack_unit_size || 1, 10);
      itemsMap[start] = { ...inv, size, type: 'occupied' };
      
      const currentEnd = currentStartNum + uSize - 1;
      const invEnd = start + size - 1;
      if (!isNaN(currentStartNum)) {
         if (currentStartNum <= invEnd && currentEnd >= start) {
           for (let i = Math.max(currentStartNum, start); i <= Math.min(currentEnd, invEnd); i++) {
             collisionUs.add(i);
           }
         }
      }
    }
  });

  if (!isNaN(currentStartNum) && currentStartNum > 0) {
    itemsMap[currentStartNum] = {
      id: 'current',
      type: 'current',
      size: uSize,
      start: currentStartNum,
      hostname: 'Selected Placement',
      hasCollision: collisionUs.size > 0
    };
  }

  const U_HEIGHT = zoomLevel; // Dynamic height for 1U
  const slotBlocks = [];
  let currentU = totalUs;

  while (currentU >= 1) {
    let matchedItem = null;
    let actualStart = currentU;

    for (const [startUStr, itemData] of Object.entries(itemsMap)) {
      const startU = parseInt(startUStr, 10);
      const endU = startU + itemData.size - 1;
      if (currentU <= endU && currentU >= startU) {
        matchedItem = itemData;
        actualStart = startU;
        break;
      }
    }

    if (matchedItem) {
      const topU = actualStart + matchedItem.size - 1; 
      const renderSize = currentU - actualStart + 1;
      
      const isCurrent = matchedItem.type === 'current';
      const isCollision = isCurrent && matchedItem.hasCollision;
      
      let bgColor = 'var(--bg-surface)';
      let borderColor = 'var(--border-default)';
      let textColor = 'var(--text-main)';
      
      if (isCurrent && !isCollision) {
        bgColor = 'var(--primary-dim)';
        borderColor = 'var(--primary)';
        textColor = 'var(--primary)';
      } else if (isCurrent && isCollision) {
        bgColor = 'var(--danger)';
        borderColor = '#b91c1c';
        textColor = '#fff';
      } else if (matchedItem.type === 'occupied') {
        const itemHasCollision = collisionUs.has(currentU);
        bgColor = itemHasCollision ? '#7f1d1d' : '#2A2B32';
        borderColor = itemHasCollision ? '#b91c1c' : '#4b5563';
        textColor = itemHasCollision ? '#fff' : 'var(--text-main)';
      }

      slotBlocks.push(
        <div 
          key={`block-${actualStart}-${currentU}`} 
          title={matchedItem.type === 'occupied' ? `[U${actualStart}-U${topU}] Click to view ${matchedItem.hostname || matchedItem.serial_number}` : ''}
          onClick={() => {
             if (matchedItem.type === 'occupied' && matchedItem.id) {
               window.open(`/inventory/${matchedItem.id}`, '_blank');
             }
          }}
          style={{
            height: `${renderSize * U_HEIGHT}px`,
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: '2px',
            margin: '1px 4px',
            display: 'flex',
            alignItems: 'center',
            boxSizing: 'border-box',
            position: 'relative',
            cursor: matchedItem.type === 'occupied' ? 'pointer' : 'default',
            transition: 'filter 0.2s',
          }}
          onMouseEnter={(e) => {
             if (matchedItem.type === 'occupied') {
               e.currentTarget.style.filter = 'brightness(1.2)';
             }
          }}
          onMouseLeave={(e) => {
             e.currentTarget.style.filter = 'none';
          }}
        >
          <div style={{
            width: '30px',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: `1px solid ${borderColor}`,
            fontSize: '0.65rem',
            color: 'var(--text-muted)'
          }}>
             {renderSize > 1 ? `${topU}` : `${actualStart}`}
             {zoomLevel > 16 && renderSize > 2 && <span style={{fontSize: '0.5rem', lineHeight: '1'}}>⋮</span>}
             {zoomLevel > 16 && renderSize > 1 && renderSize <= 2 && <span style={{fontSize: '0.5rem', lineHeight: '1'}}>·</span>}
             {renderSize > 1 ? `${actualStart}` : ''}
          </div>
          <div style={{ flex: 1, padding: '0 8px', fontSize: '0.75rem', fontWeight: 600, color: textColor, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {zoomLevel > 12 ? (matchedItem.hostname || matchedItem.serial_number || 'Device') : ''}
          </div>
        </div>
      );
      currentU = actualStart - 1;
    } else {
      const uVal = currentU;
      slotBlocks.push(
        <div 
           key={`empty-${uVal}`} 
           onClick={() => onSelectU && onSelectU(uVal)}
           style={{
             height: `${U_HEIGHT}px`,
             margin: '0px 4px',
             borderBottom: '1px dashed #3F404A',
             display: 'flex',
             alignItems: 'center',
             cursor: 'crosshair',
             transition: 'background-color 0.2s',
           }}
           onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'}
           onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <div style={{ width: '30px', textAlign: 'center', fontSize: '0.65rem', borderRight: '1px dashed #3F404A', marginRight: 8, color: 'var(--text-muted)' }}>
            {zoomLevel > 12 && uVal}
          </div>
        </div>
      );
      currentU--;
    }
  }

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
        <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>Visualizer: {rackDetails.name} ({totalUs}U)</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 'normal', fontSize: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem' }}>🔍</span>
            <input 
              type="range" 
              min="4" 
              max="40" 
              value={zoomLevel} 
              onChange={(e) => setZoomLevel(parseInt(e.target.value, 10))}
              style={{ width: '80px', cursor: 'grab' }}
              title="Zoom In/Out"
            />
          </div>
        </label>
        {collisionUs.size > 0 && <span style={{ color: 'var(--danger)', fontSize: '0.75rem', fontWeight: 600 }}>⚠️ Conflict!</span>}
      </div>
      
      <div style={{ 
        width: '100%', 
        border: '3px solid #1E1F24',
        borderTopWidth: '6px',
        borderBottomWidth: '6px',
        borderRadius: '2px',
        backgroundColor: '#111',
        display: 'flex',
        flexDirection: 'column',
        padding: '2px 0',
        maxHeight: `${Math.max(300, zoomLevel * totalUs + 50)}px`,
        overflowY: zoomLevel > 12 ? 'auto' : 'hidden'
      }}>
        {slotBlocks}
      </div>
    </div>
  );
}

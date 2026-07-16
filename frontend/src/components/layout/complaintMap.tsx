import React from 'react';
import { Box, Typography } from '@mui/material';

interface ComplaintMapProps {
    locationUrl?: string | undefined;
    complaintsList?: any[]; // Optional list of complaints to show multiple locations
    height?: string | number;
    minHeight?: string | number;
}

export default function ComplaintMap({ locationUrl, complaintsList, height = '100%', minHeight = '350px' }: ComplaintMapProps) {
    
    // Helper to extract clean query string (coordinate or address) from locationUrl
    const extractQuery = (url: string | undefined): string => {
        if (!url) return '';
        let targetUrl = url;
        if (url.includes('<iframe')) {
            const match = url.match(/src=["']([^"']+)["']/);
            if (match && match[1]) {
                targetUrl = match[1];
            }
        }
        try {
            const urlObj = new URL(targetUrl);
            const q = urlObj.searchParams.get('q');
            if (q) return q;
        } catch (e) {
            if (targetUrl.startsWith('http')) {
                const match = targetUrl.match(/[?&]q=([^&]+)/);
                if (match && match[1]) {
                    return decodeURIComponent(match[1]);
                }
            }
        }
        return targetUrl;
    };

    // If a single locationUrl is requested, render the single Google Maps iframe
    if (locationUrl) {
        if (locationUrl.includes('<iframe')) {
            return (
                <Box 
                    sx={{ 
                        width: '100%', 
                        height: height, 
                        minHeight: minHeight,
                        borderRadius: '8px', 
                        overflow: 'hidden',
                        '& iframe': { width: '100%', height: '100%', border: 0 } 
                    }}
                    dangerouslySetInnerHTML={{ __html: locationUrl }}
                />
            );
        }
        
        let srcUrl = locationUrl;
        if (locationUrl && !locationUrl.startsWith('http')) {
            srcUrl = `https://maps.google.com/maps?q=${encodeURIComponent(locationUrl)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
        }
        
        return (
            <iframe
                src={srcUrl}
                width="100%"
                height={height}
                style={{ border: 0, borderRadius: '8px', minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight }}
                allowFullScreen
                loading="lazy"
                title="Complaint Location Map"
            />
        );
    }

    // If a list of complaints is supplied, render the Leaflet multi-pin map
    if (complaintsList && complaintsList.length > 0) {
        // Pre-process and serialize map coordinates/addresses to avoid excessive geocoding in iframe if coordinates are already present
        const mapData = complaintsList.map(comp => ({
            title: comp.title || 'Complaint',
            description: comp.description || '',
            status: comp.status || 'Pending',
            query: extractQuery(comp.locationUrl || comp.locationurl)
        })).filter(item => !!item.query);

        // HTML & JavaScript template to boot Leaflet map inside iframe srcDoc
        const leafletSrcDoc = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8" />
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
              <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
              <style>
                html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
                .leaflet-popup-content-wrapper {
                  border-radius: 8px;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                  padding: 4px;
                }
                .popup-title { font-weight: bold; margin-bottom: 4px; color: #1e293b; font-size: 14px; }
                .popup-desc { color: #475569; font-size: 12px; margin-bottom: 8px; line-height: 1.4; }
                .popup-status { 
                  display: inline-block;
                  padding: 2px 6px;
                  font-size: 10px;
                  font-weight: bold;
                  color: white;
                  border-radius: 4px;
                  text-transform: uppercase;
                }
                .status-pending { background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); }
                .status-progress { background: linear-gradient(135deg, #3b82f6 0%, #eab308 100%); }
                .status-completed { background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); }
              </style>
            </head>
            <body>
              <div id="map"></div>
              <script>
                // Initialize map centered at a default coordinate (e.g. general area of West Bengal/Kolkata)
                const map = L.map('map').setView([22.5726, 88.3639], 12);
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                  attribution: '&copy; OpenStreetMap contributors'
                }).addTo(map);

                const markersData = ${JSON.stringify(mapData)};
                const bounds = [];

                // Simple rate-limited delay helper for geocoding requests
                const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

                async function plotMarkers() {
                  for (let i = 0; i < markersData.length; i++) {
                    const item = markersData[i];
                    let lat = null;
                    let lng = null;
                    
                    // Regex check for numeric coordinates (lat, lng)
                    const coordMatch = item.query.match(/^\\s*(-?\\d+\\.\\d+)\\s*,\\s*(-?\\d+\\.\\d+)\\s*$/);
                    if (coordMatch) {
                      lat = parseFloat(coordMatch[1]);
                      lng = parseFloat(coordMatch[2]);
                    } else {
                      // Text geocoding with 500ms throttle to prevent OpenStreetMap Nominatim rate limits
                      await delay(200);
                      try {
                        const response = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(item.query));
                        const data = await response.json();
                        if (data && data.length > 0) {
                          lat = parseFloat(data[0].lat);
                          lng = parseFloat(data[0].lon);
                        }
                      } catch (err) {
                        console.error("Geocoding failed for: " + item.query, err);
                      }
                    }
                    
                    if (lat !== null && lng !== null) {
                      const marker = L.marker([lat, lng]).addTo(map);
                      
                      let statusClass = 'status-pending';
                      const lowerStatus = item.status.toLowerCase();
                      if (lowerStatus.includes('progress')) {
                        statusClass = 'status-progress';
                      } else if (lowerStatus.includes('complete') || lowerStatus.includes('resolve')) {
                        statusClass = 'status-completed';
                      }
                      
                      const popupContent = 
                        '<div class="popup-title">' + item.title + '</div>' +
                        '<div class="popup-desc">' + item.description + '</div>' +
                        '<span class="popup-status ' + statusClass + '">' + item.status + '</span>';
                      
                      marker.bindPopup(popupContent);
                      bounds.push([lat, lng]);
                    }
                  }
                  
                  if (bounds.length > 0) {
                    map.fitBounds(bounds, { padding: [50, 50] });
                  }
                }
                
                plotMarkers();
              </script>
            </body>
            </html>
        `;

        return (
            <iframe
                srcDoc={leafletSrcDoc}
                width="100%"
                height={height}
                style={{ border: 0, borderRadius: '8px', minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight }}
                title="All Complaints Locations Map"
            />
        );
    }

    // Default view if no locationUrl nor complaints list is found
    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: height,
            minHeight: minHeight,
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1'
        }}>
            <Typography color="#94a3b8" variant="body2">No map locations available</Typography>
        </Box>
    );
}

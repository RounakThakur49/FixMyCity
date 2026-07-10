import React, { useEffect, useRef, useState } from 'react';
import { Navigation, AlertTriangle } from 'lucide-react';

let googleMapsPromise = null;

function loadGoogleMaps(apiKey = '') {
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve(window.google.maps);
      return;
    }
    const script = document.createElement('script');
    const keyParam = apiKey ? `&key=${apiKey}` : '';
    script.src = `https://maps.googleapis.com/maps/api/js?libraries=places${keyParam}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && window.google.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps namespace not found'));
      }
    };
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 }; // Bangalore

export default function GoogleMap({
  mode = 'detail',
  latitude,
  longitude,
  onChangeLocation,
  address,
  complaints = [],
  onSelectComplaint,
}) {
  const mapRef = useRef(null);
  const searchInputRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [geolocating, setGeolocating] = useState(false);
  const [showMap, setShowMap] = useState(() => !!(latitude && longitude));
  const [apiKey, setApiKey] = useState(() => {
    return localStorage.getItem('fixmycity-google-maps-api-key') || process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
  });

  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const markersRef = useRef([]);
  const autocompleteRef = useRef(null);

  // Sync API Key if changed in localStorage elsewhere
  useEffect(() => {
    const handleStorageChange = () => {
      const currentKey = localStorage.getItem('fixmycity-google-maps-api-key') || process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
      if (currentKey !== apiKey) {
        setApiKey(currentKey);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [apiKey]);

  // Load SDK
  useEffect(() => {
    loadGoogleMaps(apiKey)
      .then(() => setIsLoaded(true))
      .catch((err) => {
        console.error('Failed to load Google Maps SDK:', err);
        setLoadError(err);
      });
  }, [apiKey]);

  // Initialize Map
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    if (mode === 'form' && !showMap) return;

    const maps = window.google.maps;
    let initialCenter = DEFAULT_CENTER;

    if (latitude && longitude) {
      initialCenter = { lat: Number(latitude), lng: Number(longitude) };
    }

    const mapOptions = {
      center: initialCenter,
      zoom: mode === 'overview' ? 12 : 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }]
        }
      ]
    };

    const map = new maps.Map(mapRef.current, mapOptions);
    mapInstanceRef.current = map;

    // Mode-specific Logic
    if (mode === 'form') {
      // Draggable marker
      const marker = new maps.Marker({
        position: initialCenter,
        map: map,
        draggable: true,
        animation: maps.Animation.DROP,
        title: "Drag to set exact location"
      });
      markerRef.current = marker;

      // Geocoder for reverse-geocoding
      const geocoder = new maps.Geocoder();

      const updateCoordinates = (latLng) => {
        const lat = latLng.lat();
        const lng = latLng.lng();
        
        geocoder.geocode({ location: latLng }, (results, status) => {
          let geocodedAddress = '';
          if (status === 'OK' && results[0]) {
            geocodedAddress = results[0].formatted_address;
          }
          if (onChangeLocation) {
            onChangeLocation({
              latitude: lat,
              longitude: lng,
              address: geocodedAddress || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
            });
          }
        });
      };

      // Dragend listener
      maps.event.addListener(marker, 'dragend', () => {
        updateCoordinates(marker.getPosition());
      });

      // Click on map listener to move marker
      maps.event.addListener(map, 'click', (event) => {
        marker.setPosition(event.latLng);
        updateCoordinates(event.latLng);
      });
    } else if (mode === 'detail') {
      // Single static marker
      new maps.Marker({
        position: initialCenter,
        map: map,
        title: "Reported Location"
      });
    } else if (mode === 'overview') {
      // Multiple markers
      renderOverviewMarkers(maps, map);
    }

    return () => {
      // Clean up markers
      if (markerRef.current) {
        markerRef.current.setMap(null);
      }
      clearOverviewMarkers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mode, showMap]);

  // Handle outside changes to latitude/longitude in form/detail mode
  useEffect(() => {
    if (!isLoaded || !mapInstanceRef.current || mode === 'overview') return;
    if (latitude && longitude) {
      const newPos = { lat: Number(latitude), lng: Number(longitude) };
      mapInstanceRef.current.setCenter(newPos);
      if (markerRef.current) {
        markerRef.current.setPosition(newPos);
      }
    }
  }, [latitude, longitude, isLoaded, mode]);

  // Bind Autocomplete to input in Form mode
  useEffect(() => {
    if (!isLoaded || mode !== 'form' || !mapInstanceRef.current || !markerRef.current) return;
    
    const maps = window.google.maps;
    if (searchInputRef.current) {
      const autocomplete = new maps.places.Autocomplete(searchInputRef.current);
      autocompleteRef.current = autocomplete;
      autocomplete.bindTo('bounds', mapInstanceRef.current);

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;

        const location = place.geometry.location;
        mapInstanceRef.current.setCenter(location);
        mapInstanceRef.current.setZoom(16);
        markerRef.current.setPosition(location);

        if (onChangeLocation) {
          onChangeLocation({
            latitude: location.lat(),
            longitude: location.lng(),
            address: place.formatted_address || place.name
          });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mode]);

  // Re-render overview markers when complaints change
  useEffect(() => {
    if (isLoaded && mode === 'overview' && mapInstanceRef.current) {
      const maps = window.google.maps;
      clearOverviewMarkers();
      renderOverviewMarkers(maps, mapInstanceRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaints, isLoaded, mode]);

  const clearOverviewMarkers = () => {
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
  };

  const getMarkerIcon = (maps, status) => {
    let color = 'red';
    if (status === 'Resolved') color = 'green';
    else if (status === 'In Review') color = 'yellow';
    else if (status === 'Forwarded') color = 'orange';

    return `https://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;
  };

  const renderOverviewMarkers = (maps, map) => {
    const infoWindow = new maps.InfoWindow();
    const bounds = new maps.LatLngBounds();
    let hasCoords = false;

    complaints.forEach((c) => {
      if (!c.latitude || !c.longitude) return;
      hasCoords = true;

      const pos = { lat: Number(c.latitude), lng: Number(c.longitude) };
      bounds.extend(pos);

      const marker = new maps.Marker({
        position: pos,
        map: map,
        title: c.title,
        icon: getMarkerIcon(maps, c.status)
      });

      marker.addListener('click', () => {
        const contentString = `
          <div style="padding: 10px; font-family: system-ui, -apple-system, sans-serif; max-width: 220px; line-height: 1.4;">
            <div style="font-size: 10px; color: #8a8a8a; font-weight: 700; margin-bottom: 2px;">${c.id}</div>
            <h4 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 700; color: #1A2438;">${c.title}</h4>
            <div style="font-size: 11px; color: #555; margin-bottom: 8px;">Category: <strong>${c.type}</strong></div>
            <div style="margin-bottom: 8px;">
              <span style="display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: 700; border-radius: 4px; background-color: #f1f5f9; color: #475569;">
                Status: ${c.status}
              </span>
            </div>
            <button 
              id="info-btn-${c.id}" 
              style="background: #0f766e; color: #fff; border: none; padding: 6px 8px; font-size: 11px; border-radius: 6px; cursor: pointer; font-weight: 600; width: 100%; margin-top: 4px;"
            >
              View Details
            </button>
          </div>
        `;

        infoWindow.setContent(contentString);
        infoWindow.open(map, marker);

        maps.event.addListener(infoWindow, 'domready', () => {
          const btn = document.getElementById(`info-btn-${c.id}`);
          if (btn) {
            btn.onclick = () => {
              if (onSelectComplaint) {
                onSelectComplaint(c.id);
              }
            };
          }
        });
      });

      markersRef.current.push(marker);
    });

    if (hasCoords) {
      map.fitBounds(bounds);
      const listener = maps.event.addListener(map, 'idle', () => {
        if (map.getZoom() > 16) map.setZoom(15);
        maps.event.removeListener(listener);
      });
    }
  };

  const handleGeolocate = () => {
    setShowMap(true);
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeolocating(false);
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const latLng = { lat, lng };

        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter(latLng);
          mapInstanceRef.current.setZoom(16);
        }
        if (markerRef.current) {
          markerRef.current.setPosition(latLng);
        }

        // Propagate the raw GPS fix to the parent IMMEDIATELY and unconditionally.
        // Address reverse-geocoding is best-effort and only works once the Maps
        // SDK has loaded — but the coordinates themselves must always reach state
        // (previously they were trapped inside `if (isLoaded)`, so a missing/invalid
        // Maps API key meant live location was captured but never stored).
        const fallbackAddr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        const emit = (addr) => {
          if (onChangeLocation) {
            onChangeLocation({ latitude: lat, longitude: lng, address: addr || fallbackAddr });
          }
        };

        if (isLoaded && window.google?.maps) {
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ location: latLng }, (results, status) => {
            emit(status === 'OK' && results[0] ? results[0].formatted_address : fallbackAddr);
          });
        } else {
          emit(fallbackAddr);
        }
      },
      (error) => {
        setGeolocating(false);
        console.error("Error geolocating user:", error);
        alert("Failed to retrieve your location. Please check browser location permissions and try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  if (loadError) {
    return (
      <div className="map-error-placeholder">
        <AlertTriangle size={32} color="#dc2626" />
        <h4>Map Loading Failed</h4>
        <p>Google Maps script failed to load. Check your network or API Key.</p>
        <button type="button" className="map-retry-btn" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className={`map-wrapper-card ${mode}`}>
      {mode === 'form' && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="map-search-bar-container">
            <input
              ref={searchInputRef}
              type="text"
              className="map-search-input"
              placeholder="Search street, area or landmark..."
              defaultValue={address && !address.match(/^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/) ? address : ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
            />
            <button
              type="button"
              className="map-locate-btn"
              onClick={handleGeolocate}
              disabled={geolocating}
              title="Use current location"
            >
              <Navigation size={15} className={geolocating ? 'spinning' : ''} style={{ marginRight: '6px' }} />
              <span>{geolocating ? 'Locating...' : 'Use My Location'}</span>
            </button>
          </div>
          <div style={{ marginBottom: showMap ? '12px' : '0px' }}>
            <button
              type="button"
              className="map-toggle-view-btn"
              onClick={() => setShowMap(!showMap)}
            >
              {showMap ? 'Hide Map Pin' : 'Adjust Pin on Live Map'}
            </button>
          </div>
        </div>
      )}

      {!isLoaded && (mode !== 'form' || showMap) ? (
        <div className="map-loading-placeholder">
          <div className="map-loading-spinner" />
          <span>Loading Live Map...</span>
        </div>
      ) : null}

      {(mode !== 'form' || showMap) && (
        <div
          ref={mapRef}
          className="map-canvas-div"
          style={{
            width: '100%',
            height: mode === 'overview' ? 'calc(100vh - 280px)' : '250px',
            minHeight: '250px',
            borderRadius: '12px',
            overflow: 'hidden',
            display: isLoaded ? 'block' : 'none',
            marginTop: mode === 'form' ? '6px' : '10px',
          }}
        />
      )}
    </div>
  );
}

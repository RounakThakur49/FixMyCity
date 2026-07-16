import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities only in Andhra Pradesh
const andhraPradeshCities: readonly string[] = [
  'Anantapur',
  'Chittoor',
  'Eluru',
  'Guntur',
  'Kadapa',
  'Kakinada',
  'Kurnool',
  'Machilipatnam',
  'Nellore',
  'Ongole',
  'Rajahmundry',
  'Srikakulam',
  'Tirupati',
  'Vijayawada',
  'Visakhapatnam',
  'Vizianagaram'
];

interface AndhraPradeshCitySelectProps {
  /** Callback function to pass the selected city back to a parent form/component */
  onCityChange?: (city: string | null) => void;
  /** Custom label for the input field, defaults to "Select City (Andhra Pradesh)" */
  label?: string;
}

export default function AndhraPradeshCitySelect({ onCityChange, label }: AndhraPradeshCitySelectProps) {
  const [value, setValue] = useState<string | null>(null);

  return (
    <Autocomplete
      id="andhra-pradesh-city-select"
      sx={{ width: "100%" }}
      options={andhraPradeshCities}
      autoHighlight
      value={value}
      onChange={(event, newValue) => {
        setValue(newValue);
        if (onCityChange) {
          onCityChange(newValue);
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label || "Select City (Andhra Pradesh)"}
          variant="outlined"
          placeholder="Search AP cities..."
        />
      )}
    />
  );
}
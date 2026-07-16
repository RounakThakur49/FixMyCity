import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities and major towns in Assam
const assamCities: readonly string[] = [
  'Barpeta',
  'Bongaigaon',
  'Dhubri',
  'Dibrugarh',
  'Diphu',
  'Goalpara',
  'Golaghat',
  'Guwahati',
  'Hailakandi',
  'Jorhat',
  'Karimganj',
  'Kokrajhar',
  'Lakhimpur',
  'Nagaon',
  'Nalbari',
  'Sibsagar',
  'Silchar',
  'Tezpur',
  'Tinsukia'
];

interface AssamCitySelectProps {
  /** Callback function to pass the selected city back to a parent form/component */
  onCityChange?: (city: string | null) => void;
  /** Custom label for the input field, defaults to "Select City (Assam)" */
  label?: string;
}

export default function AssamCitySelect({ onCityChange, label }: AssamCitySelectProps) {
  const [value, setValue] = useState<string | null>(null);

  return (
    <Autocomplete
      id="assam-city-select"
      sx={{ width: "100%" }}
      options={assamCities}
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
          label={label || "Select City (Assam)"}
          variant="outlined"
          placeholder="Search Assam cities..."
        />
      )}
    />
  );
}
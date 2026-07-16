import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities and town headquarters in Arunachal Pradesh
const arunachalPradeshCities: readonly string[] = [
    'Aalo',
    'Bomdila',
    'Changlang',
    'Daporijo',
    'Itanagar',
    'Khonsa',
    'Mebo',
    'Namsai',
    'Naharlagun',
    'Pasighat',
    'Roing',
    'Seppa',
    'Tawang',
    'Tezu',
    'Yingkiong',
    'Ziro'
];

interface ArunachalPradeshCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Arunachal Pradesh)" */
    label?: string;
}

export default function ArunachalPradeshCitySelect({ onCityChange, label }: ArunachalPradeshCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="arunachal-pradesh-city-select"
            sx={{ width: "100%" }}
            options={arunachalPradeshCities}
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
                    label={label || "Select City (Arunachal Pradesh)"}
                    variant="outlined"
                    placeholder="Search Arunachal cities..."
                />
            )}
        />
    );
}
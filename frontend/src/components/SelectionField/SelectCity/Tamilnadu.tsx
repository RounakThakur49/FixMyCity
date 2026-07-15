import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const tamilNaduCities: readonly string[] = [
    'Chennai',
    'Coimbatore',
    'Erode',
    'Madurai',
    'Nagercoil',
    'Salem',
    'Thanjavur',
    'Thoothukudi',
    'Tirunelveli',
    'Tiruppur',
    'Trichy',
    'Vellore'
];
interface TamilnaduCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function TamilnaduCitySelect({ onCityChange, label }: TamilnaduCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Tamilnadu-city-select"
            sx={{ width: "100%" }}
            options={tamilNaduCities}
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